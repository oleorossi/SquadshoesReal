-- =============================================================================
-- Auditoria de fill-rate em technical_sheets
-- =============================================================================
-- Lista cada coluna da tabela `technical_sheets` mostrando:
--   • total_rows           — número total de fichas técnicas
--   • non_null             — quantas fichas têm valor NÃO-NULL
--   • non_empty            — quantas fichas têm valor "útil" (não NULL,
--                            não string vazia, não 0 numérico, não false,
--                            não array/object vazio)
--   • fill_rate_pct        — non_empty × 100 / total_rows
--
-- Objetivo: identificar colunas que ninguém preenche (fill_rate_pct ≈ 0%) —
-- candidatas a remoção na reformulação da ficha técnica.
--
-- Como usar:
--   1) Cole o bloco inteiro no SQL Editor.
--   2) Execute. Sai uma tabela ordenada do MENOS preenchido pro MAIS.
--   3) Tudo abaixo de 5% provavelmente é morto. Acima disso, vale revisar
--      caso a caso (pode ser feature opcional usada em modelos específicos).
--
-- Não modifica nada — só leitura.
-- =============================================================================

DO $$
DECLARE
  v_total_rows bigint;
  v_col record;
  v_query text;
  v_non_null bigint;
  v_non_empty bigint;
  v_results jsonb := '[]'::jsonb;
BEGIN
  -- Contagem total
  SELECT COUNT(*) INTO v_total_rows FROM public.technical_sheets;

  IF v_total_rows = 0 THEN
    RAISE NOTICE 'Tabela technical_sheets está vazia — nada pra auditar.';
    RETURN;
  END IF;

  -- Para cada coluna, calcula fill rate
  FOR v_col IN
    SELECT column_name, data_type, udt_name
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name   = 'technical_sheets'
       AND column_name NOT IN ('id','created_at','updated_at','user_id','organization_id')
     ORDER BY column_name
  LOOP
    -- non_null
    EXECUTE format(
      'SELECT COUNT(*) FROM public.technical_sheets WHERE %I IS NOT NULL',
      v_col.column_name
    ) INTO v_non_null;

    -- non_empty (depende do tipo)
    IF v_col.data_type IN ('text','character varying','character','citext') THEN
      v_query := format(
        'SELECT COUNT(*) FROM public.technical_sheets WHERE %I IS NOT NULL AND TRIM(%I) <> ''''',
        v_col.column_name, v_col.column_name
      );
    ELSIF v_col.data_type IN ('numeric','integer','bigint','smallint','double precision','real') THEN
      v_query := format(
        'SELECT COUNT(*) FROM public.technical_sheets WHERE %I IS NOT NULL AND %I <> 0',
        v_col.column_name, v_col.column_name
      );
    ELSIF v_col.data_type = 'boolean' THEN
      -- Boolean: "preenchido" = TRUE (FALSE conta como default)
      v_query := format(
        'SELECT COUNT(*) FROM public.technical_sheets WHERE %I = TRUE',
        v_col.column_name
      );
    ELSIF v_col.data_type IN ('jsonb','json') THEN
      -- JSONB: vazio = NULL, '{}', '[]', null literal
      v_query := format(
        'SELECT COUNT(*) FROM public.technical_sheets ' ||
        'WHERE %I IS NOT NULL ' ||
        '  AND %I::text NOT IN (''null'',''{}'',''[]'') ' ||
        '  AND ((jsonb_typeof(%I) = ''object'' AND (SELECT COUNT(*) FROM jsonb_object_keys(%I)) > 0) ' ||
        '       OR (jsonb_typeof(%I) = ''array''  AND jsonb_array_length(%I) > 0) ' ||
        '       OR jsonb_typeof(%I) NOT IN (''object'',''array''))',
        v_col.column_name, v_col.column_name,
        v_col.column_name, v_col.column_name,
        v_col.column_name, v_col.column_name,
        v_col.column_name
      );
    ELSIF v_col.data_type IN ('ARRAY','USER-DEFINED') THEN
      v_query := format(
        'SELECT COUNT(*) FROM public.technical_sheets WHERE %I IS NOT NULL',
        v_col.column_name
      );
    ELSE
      -- date, timestamp, uuid, etc. — basta NÃO NULL
      v_query := format(
        'SELECT COUNT(*) FROM public.technical_sheets WHERE %I IS NOT NULL',
        v_col.column_name
      );
    END IF;

    EXECUTE v_query INTO v_non_empty;

    v_results := v_results || jsonb_build_object(
      'column_name', v_col.column_name,
      'data_type', v_col.data_type,
      'total_rows', v_total_rows,
      'non_null', v_non_null,
      'non_empty', v_non_empty,
      'fill_rate_pct', ROUND((v_non_empty::numeric * 100 / v_total_rows), 1)
    );
  END LOOP;

  -- Cria tabela temporária para retornar como resultado tabular
  DROP TABLE IF EXISTS pg_temp.tech_sheets_fill_audit;
  CREATE TEMP TABLE tech_sheets_fill_audit AS
    SELECT
      (j->>'column_name')::text                      AS coluna,
      (j->>'data_type')::text                        AS tipo,
      (j->>'total_rows')::bigint                     AS total,
      (j->>'non_null')::bigint                       AS nao_null,
      (j->>'non_empty')::bigint                      AS preenchido,
      (j->>'fill_rate_pct')::numeric                 AS fill_pct
    FROM jsonb_array_elements(v_results) AS j;

  RAISE NOTICE 'Auditoria gerada com % colunas. Selecione tech_sheets_fill_audit pra ver.', jsonb_array_length(v_results);
END $$;

-- ─── Resultado ──────────────────────────────────────────────────────────────
-- Primeiro: top 30 colunas MENOS preenchidas (candidatas a remoção)
SELECT
  coluna,
  tipo,
  preenchido,
  total,
  fill_pct AS "fill_pct (%)",
  CASE
    WHEN fill_pct = 0    THEN 'NUNCA usada — remover'
    WHEN fill_pct < 5    THEN 'Quase nunca — provável morta'
    WHEN fill_pct < 25   THEN 'Pouco usada — revisar caso a caso'
    WHEN fill_pct < 75   THEN 'Uso parcial'
    ELSE 'Bem preenchida'
  END AS recomendacao
FROM tech_sheets_fill_audit
ORDER BY fill_pct ASC, coluna ASC
LIMIT 30;
