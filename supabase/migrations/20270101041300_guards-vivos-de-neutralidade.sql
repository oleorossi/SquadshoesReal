-- =============================================================================
-- Guards VIVOS da neutralidade de PV
-- =============================================================================
-- Por que isto existe: o contrato que deveria ter pego o PV-00195 lia o ARQUIVO
-- da migration, não a função do banco. Um arquivo correto no repo com a função
-- viva regredida passa verde — e foi exatamente a hipótese que tivemos de
-- refutar à mão durante a investigação, consultando pg_proc.
--
-- Segue o idioma de run_sole_live_parity_guards(): devolve (case_name, ok,
-- message) e inspeciona pg_get_functiondef + comportamento REAL, não o .sql.
--
-- Somente leitura. Pode rodar contra produção.
--
-- Marcador: guards_vivos_de_neutralidade_20270101041300
-- =============================================================================

CREATE OR REPLACE FUNCTION public.run_sale_order_neutrality_live_guards()
RETURNS TABLE (case_name text, ok boolean, message text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_neutral text;
  v_preflight text;
  v_execute text;
BEGIN
  -- guards_vivos_de_neutralidade_20270101041300
  SELECT pg_get_functiondef(p.oid) INTO v_neutral
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'sale_order_update_is_production_neutral';

  SELECT pg_get_functiondef(p.oid) INTO v_preflight
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'preflight_sale_order_command'
     AND pg_get_function_identity_arguments(p.oid) LIKE '%p_payload jsonb';

  SELECT pg_get_functiondef(p.oid) INTO v_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'execute_sale_order_command';

  -- A escapatória documental da 24100 continua viva?
  RETURN QUERY SELECT
    'escapatoria_documental_viva_no_preflight'::text,
    COALESCE(position('NOT public.sale_order_update_is_production_neutral' IN v_preflight) > 0, false),
    'preflight deve guardar o blocker de cancel_op_ids com NOT ...is_production_neutral'::text;

  RETURN QUERY SELECT
    'escapatoria_documental_viva_no_execute'::text,
    COALESCE(position('pv_header_save_skips_op_rewrite_20270101024100' IN v_execute) > 0, false),
    'execute_sale_order_command perdeu o marcador da 20270101024100'::text;

  -- A cegueira à chave derivável continua viva?
  RETURN QUERY SELECT
    'neutralidade_usa_normalizador_de_pv_origem'::text,
    COALESCE(position('private.strap_colors_neutrality_shape' IN v_neutral) > 0, false),
    'sale_order_update_is_production_neutral deve comparar strap_colors pelo normalizador'::text;

  RETURN QUERY SELECT
    'neutralidade_nao_compara_strap_colors_cru'::text,
    COALESCE(position(
      'END IS DISTINCT FROM COALESCE(soi.strap_colors' IN v_neutral) = 0, false),
    'voltou a comparar strap_colors cru - a hidratacao do cliente volta a bloquear save documental'::text;

  RETURN QUERY SELECT
    'preflight_nomeia_o_culpado'::text,
    COALESCE(position('bloqueio_de_neutralidade_nomeia_culpado_20270101041200' IN v_preflight) > 0, false),
    'preflight perdeu a mensagem que nomeia campo e OPs'::text;

  -- Comportamento do normalizador: ausente deriva, explícito NÃO é tocado.
  RETURN QUERY SELECT
    'normalizador_deriva_buy_ready'::text,
    private.strap_colors_neutrality_shape(
      '[{"technical_strap_line_id":"11111111-1111-4111-8111-111111111111"}]'::jsonb,
      '{"11111111-1111-4111-8111-111111111111":{"source_mode":"buy_ready"}}'::jsonb
    ) -> 0 ->> 'pv_origem' = 'sku_acabado',
    'buy_ready sem pv_origem deve virar sku_acabado'::text;

  RETURN QUERY SELECT
    'normalizador_deriva_internal'::text,
    private.strap_colors_neutrality_shape(
      '[{"technical_strap_line_id":"11111111-1111-4111-8111-111111111111"}]'::jsonb,
      '{"11111111-1111-4111-8111-111111111111":{"source_mode":"internal"}}'::jsonb
    ) -> 0 ->> 'pv_origem' = 'fabrica',
    'internal sem pv_origem deve virar fabrica (espelha o cliente)'::text;

  RETURN QUERY SELECT
    'normalizador_preserva_origem_explicita'::text,
    private.strap_colors_neutrality_shape(
      '[{"technical_strap_line_id":"11111111-1111-4111-8111-111111111111","pv_origem":"prestador"}]'::jsonb,
      '{"11111111-1111-4111-8111-111111111111":{"source_mode":"internal"}}'::jsonb
    ) -> 0 ->> 'pv_origem' = 'prestador',
    'pv_origem explicito NUNCA pode ser sobrescrito pela derivacao'::text;

  RETURN QUERY SELECT
    'normalizador_sem_source_mode_nao_inventa'::text,
    NOT (private.strap_colors_neutrality_shape(
      '[{"technical_strap_line_id":"11111111-1111-4111-8111-111111111111"}]'::jsonb,
      '{}'::jsonb
    ) -> 0 ? 'pv_origem'),
    'sem source_mode nao ha de onde derivar - nao pode inventar chave'::text;

  RETURN QUERY SELECT
    'normalizador_preserva_ordem'::text,
    private.strap_colors_neutrality_shape(
      '[{"technical_strap_line_id":"11111111-1111-4111-8111-111111111111","n":1},
        {"technical_strap_line_id":"22222222-2222-4222-8222-222222222222","n":2}]'::jsonb,
      '{}'::jsonb
    ) = '[{"technical_strap_line_id":"11111111-1111-4111-8111-111111111111","n":1},
          {"technical_strap_line_id":"22222222-2222-4222-8222-222222222222","n":2}]'::jsonb,
    'ordem das linhas e significativa na comparacao jsonb - nao pode ser reordenada'::text;

  RETURN QUERY SELECT
    'normalizador_ignora_id_nao_uuid'::text,
    NOT (private.strap_colors_neutrality_shape(
      '[{"id":"TIRA 1"}]'::jsonb,
      '{"TIRA 1":{"source_mode":"buy_ready"}}'::jsonb
    ) -> 0 ? 'pv_origem'),
    'so UUID e identidade de linha (espelha technicalStrapLineId); rotulo nao vira chave'::text;

  RETURN QUERY SELECT
    'explain_existe_e_devolve_summary'::text,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'explain_sale_order_update_non_neutrality') = 1,
    'explain_sale_order_update_non_neutrality deve existir para a mensagem do blocker'::text;
END;
$fn$;

REVOKE ALL ON FUNCTION public.run_sale_order_neutrality_live_guards() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_sale_order_neutrality_live_guards()
  TO authenticated, service_role;

COMMENT ON FUNCTION public.run_sale_order_neutrality_live_guards() IS
  'Guards do corpo VIVO da neutralidade de PV — contrato que lê arquivo não pega regressão em CREATE OR REPLACE.';
