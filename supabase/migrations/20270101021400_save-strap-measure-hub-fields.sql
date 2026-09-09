-- Hub de Tiras: origem/preços da medida só via RPC SECURITY DEFINER.
-- authenticated tem GRANT SELECT (e RLS só SELECT) em artisanal_strap_measures;
-- UPDATE direto do cliente (diálogo do PV / editor do Hub) vira 42501.
-- Spec origem-tira-pv-hub-os §15.

CREATE OR REPLACE FUNCTION public.save_artisanal_strap_measure_hub_fields(
  p_measure_id uuid,
  p_payload jsonb,
  p_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_reason text;
  v_origem text;
  v_preco_artesanal numeric;
  v_preco_prestador numeric;
BEGIN
  PERFORM public.assert_artisanal_strap_capability('manage_strap_catalog');

  IF p_measure_id IS NULL THEN
    RAISE EXCEPTION 'Medida de tira obrigatória';
  END IF;

  IF p_payload IS NULL OR p_payload = '{}'::jsonb THEN
    RAISE EXCEPTION 'Payload vazio: informe origem ou preço da medida';
  END IF;

  IF NOT (
    (p_payload ? 'origem_padrao')
    OR (p_payload ? 'preco_artesanal_per_m')
    OR (p_payload ? 'preco_prestador_per_m')
  ) THEN
    RAISE EXCEPTION 'Payload sem campos de Hub (origem_padrao / preços)';
  END IF;

  IF (
    (p_payload ? 'preco_artesanal_per_m')
    OR (p_payload ? 'preco_prestador_per_m')
  ) AND NOT public.can_see_strap_financial_values() THEN
    RAISE EXCEPTION 'Sem permissão para ver/editar valores financeiros do Hub';
  END IF;

  IF p_payload ? 'origem_padrao' THEN
    v_origem := nullif(btrim(coalesce(p_payload->>'origem_padrao', '')), '');
    IF v_origem IS NULL
       OR v_origem NOT IN ('sempre_fabrica', 'sempre_sku_acabado', 'escolhe_no_pv') THEN
      RAISE EXCEPTION 'origem_padrao inválida';
    END IF;
  END IF;

  IF p_payload ? 'preco_artesanal_per_m'
     AND jsonb_typeof(p_payload->'preco_artesanal_per_m') IS DISTINCT FROM 'null' THEN
    BEGIN
      v_preco_artesanal := (p_payload->>'preco_artesanal_per_m')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'preco_artesanal_per_m inválido';
    END;
    IF v_preco_artesanal < 0 THEN
      RAISE EXCEPTION 'preco_artesanal_per_m não pode ser negativo';
    END IF;
  END IF;

  IF p_payload ? 'preco_prestador_per_m'
     AND jsonb_typeof(p_payload->'preco_prestador_per_m') IS DISTINCT FROM 'null' THEN
    BEGIN
      v_preco_prestador := (p_payload->>'preco_prestador_per_m')::numeric;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'preco_prestador_per_m inválido';
    END;
    IF v_preco_prestador < 0 THEN
      RAISE EXCEPTION 'preco_prestador_per_m não pode ser negativo';
    END IF;
  END IF;

  v_reason := public.require_strap_change_reason(
    p_reason,
    'Completar Hub de Tiras pelo PV'
  );
  PERFORM set_config('app.strap_change_reason', v_reason, true);

  UPDATE public.artisanal_strap_measures
     SET origem_padrao = CASE
           WHEN p_payload ? 'origem_padrao' THEN v_origem
           ELSE origem_padrao
         END,
         preco_artesanal_per_m = CASE
           WHEN NOT (p_payload ? 'preco_artesanal_per_m') THEN preco_artesanal_per_m
           WHEN jsonb_typeof(p_payload->'preco_artesanal_per_m') = 'null' THEN NULL
           ELSE v_preco_artesanal
         END,
         preco_prestador_per_m = CASE
           WHEN NOT (p_payload ? 'preco_prestador_per_m') THEN preco_prestador_per_m
           WHEN jsonb_typeof(p_payload->'preco_prestador_per_m') = 'null' THEN NULL
           ELSE v_preco_prestador
         END
   WHERE id = p_measure_id
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Medida de tira inexistente';
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.save_artisanal_strap_measure_hub_fields(uuid, jsonb, text) IS
  'Grava origem_padrao e/ou preços da medida no Hub. Só chaves presentes no jsonb; json null zera o preço. Exige manage_strap_catalog; preços exigem can_see_strap_financial_values.';

REVOKE ALL ON FUNCTION public.save_artisanal_strap_measure_hub_fields(uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_artisanal_strap_measure_hub_fields(uuid, jsonb, text)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
