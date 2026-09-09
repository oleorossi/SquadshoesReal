-- Batch de diagnose de readiness de tiras p/ o editor do PV.
-- Um round-trip no open (tuplas únicas) no lugar de N× diagnose unitário
-- por item — causa #1 do statement_timeout ao abrir pedido longo.

CREATE OR REPLACE FUNCTION public.diagnose_sale_order_internal_strap_readiness_batch(
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_entry jsonb;
  v_reference_id uuid;
  v_material_variant_id uuid;
  v_color text;
  v_key text;
  v_result jsonb := '{}'::jsonb;
  v_diag jsonb;
  v_seen text[] := ARRAY[]::text[];
BEGIN
  IF NOT public.is_approved_user() THEN
    RAISE EXCEPTION 'Somente usuario aprovado pode consultar o cadastro de tiras'
      USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN v_result;
  END IF;

  FOR v_entry IN
    SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    BEGIN
      v_reference_id := public.try_parse_uuid(v_entry ->> 'reference_id');
    EXCEPTION WHEN OTHERS THEN
      v_reference_id := NULL;
    END;
    CONTINUE WHEN v_reference_id IS NULL;

    BEGIN
      v_material_variant_id := public.try_parse_uuid(v_entry ->> 'material_variant_id');
    EXCEPTION WHEN OTHERS THEN
      v_material_variant_id := NULL;
    END;

    v_color := nullif(trim(coalesce(v_entry ->> 'color', '')), '');
    v_key := v_reference_id::text
      || '|'
      || coalesce(v_material_variant_id::text, '')
      || '|'
      || coalesce(v_color, '');

    CONTINUE WHEN v_key = ANY (v_seen);
    v_seen := array_append(v_seen, v_key);

    v_diag := public.diagnose_sale_order_internal_strap_readiness(
      v_reference_id,
      v_material_variant_id,
      v_color
    );
    v_result := v_result || jsonb_build_object(v_key, v_diag);
  END LOOP;

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.diagnose_sale_order_internal_strap_readiness_batch(jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.diagnose_sale_order_internal_strap_readiness_batch(jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.diagnose_sale_order_internal_strap_readiness_batch(jsonb) IS
  'Diagnostico de readiness de tiras em lote p/ o editor do PV. '
  'Recebe [{reference_id, material_variant_id, color}, ...] e devolve '
  'objeto keyed por "ref|variant|color" com o mesmo payload do diagnose unitario.';
