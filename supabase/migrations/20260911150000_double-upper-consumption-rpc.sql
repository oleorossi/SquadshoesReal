-- =============================================================================
-- double_upper_consumption(p_sheet_ids uuid[]) — normalização assistida pé×par
-- =============================================================================
--
-- Spec: specs/consumo-cabedal-padrao-par.md (R4).
--
-- O canônico do consumo de cabedal é POR PAR (upper_consumption +
-- upper_consumption_per_size), mas algumas fichas foram preenchidas com o
-- valor POR PÉ (metade do real) → subcusteiam ~2×. Não dá pra separar por
-- regra numérica cega (unidades misturadas dm²/par × m/par, placeholders,
-- lixo), então a correção é ASSISTIDA: o painel em /system-diagnostics →
-- Consumo lista as fichas, o usuário MARCA as preenchidas por pé e aplica ×2.
--
-- Esta função dobra, nas fichas selecionadas:
--   - upper_consumption (escalar), arredondado a 4 casas (convenção do form);
--   - CADA chave de upper_consumption_per_size (inclusive numerações
--     conjugadas como "33/34"), também a 4 casas.
--
-- Semântica:
--   - UM único UPDATE → atômico para o lote inteiro (mais forte que o
--     "atômico por ficha" pedido na spec).
--   - NÃO é idempotente por design — aplicar 2× dobra 2×. O painel confirma
--     antes de aplicar e nada vem pré-marcado.
--   - Valores não-numéricos no JSONB (defensivo; o form só grava números)
--     são preservados como estão, sem abortar o lote.
--   - JSONB NULL permanece NULL; '{}' permanece '{}'.
--
-- Retorna o número de fichas atualizadas (pro toast do painel).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.double_upper_consumption(p_sheet_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  IF p_sheet_ids IS NULL OR array_length(p_sheet_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE technical_sheets ts SET
    upper_consumption = round(COALESCE(ts.upper_consumption, 0) * 2, 4),
    upper_consumption_per_size = CASE
      WHEN ts.upper_consumption_per_size IS NULL THEN NULL
      ELSE
        -- Chaves numéricas dobradas…
        COALESCE(
          (SELECT jsonb_object_agg(e.key, to_jsonb(round(e.value::numeric * 2, 4)))
             FROM jsonb_each_text(ts.upper_consumption_per_size) e
            WHERE e.value ~ '^-?[0-9]+(\.[0-9]+)?$'),
          '{}'::jsonb
        )
        -- …+ chaves não-numéricas preservadas (defensivo).
        || COALESCE(
          (SELECT jsonb_object_agg(e2.key, ts.upper_consumption_per_size -> e2.key)
             FROM jsonb_each_text(ts.upper_consumption_per_size) e2
            WHERE e2.value IS NULL OR NOT (e2.value ~ '^-?[0-9]+(\.[0-9]+)?$')),
          '{}'::jsonb
        )
    END
  WHERE ts.id = ANY(p_sheet_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;
