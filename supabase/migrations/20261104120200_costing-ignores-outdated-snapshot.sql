-- ============================================================================
-- Custeio correto — auditoria de 03/08/2026.
--
-- Sintoma em produção (259 linhas de order_costs):
--   margem média armazenada = −59,3%
--   custo médio R$ 45,65/par contra preço médio R$ 24,93/par
--
-- A causa raiz NÃO era o motor de consumo — era a leitura do snapshot em
-- calculate_order_cost_item:
--
--   SELECT consumption_snapshot, quantity INTO v_cons, v_snap_qty
--     FROM public.technical_sheet_snapshots
--    WHERE sale_order_id = v_sale_order_id
--      AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)
--    LIMIT 1;                       -- ← sem outdated_at, sem ORDER BY
--
-- `technical_sheet_snapshots` tem 115 linhas e 112 (97%) com outdated_at
-- preenchido. O custeio usava todas. Medido no PV-00122:
--   · snapshot congelado em 20/05/2026, marcado desatualizado em 28/07/2026
--   · dentro dele, "Elástico 30mm" a 1620 un/par
--   · o motor VIVO dá 20 un/par pra mesma ficha
--   · R$ 48.600 de elástico num item com R$ 358 de receita
--
-- Por isso "é só recalcular" não resolvia: o recálculo relia o mesmo snapshot.
-- Depois deste fix, PV-00122 foi de R$ 140.855,97 → R$ 2.696,75 (margem +22,8%
-- contra receita de R$ 3.494) e o agregado das 259 linhas foi de −59,3% para
-- +61,1% de margem ponderada.
--
-- Decisões do dono (03/08/2026):
--   · snapshot VÁLIDO continua congelando custo — proteção contábil do vendido;
--   · snapshot com outdated_at é ignorado, custo vem do motor atual;
--   · os 112 snapshots NÃO são regravados: seguem sendo o registro do que foi
--     de fato reservado/debitado, lido por produção e estoque.
--
-- O ORDER BY entra junto: com dois snapshots do mesmo item, LIMIT 1 sem
-- ordenação escolhia um arbitrariamente e o custo mudava entre execuções
-- idênticas.
--
-- Método: calculate_order_cost_item tem ~12 KB. Recortamos o bloco EXATO e
-- abortamos alto se ele não bater, em vez de recopiar a função inteira (que
-- arrastaria deriva de outras partes do corpo).
-- ============================================================================

DO $migration$
DECLARE
  v_def text;
  v_new text;
  v_old text := E'  SELECT consumption_snapshot, quantity INTO v_cons, v_snap_qty\n'
                '    FROM public.technical_sheet_snapshots\n'
                '   WHERE sale_order_id = v_sale_order_id\n'
                '     AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)\n'
                '   LIMIT 1;';
  v_fix text := E'  -- Só snapshot VÁLIDO congela custo. Com outdated_at preenchido o custo\n'
                '  -- volta pro motor vivo (decisão 03/08/2026) — 97% dos snapshots estavam\n'
                '  -- marcados e o custeio usava todos, reproduzindo o consumo de maio.\n'
                '  -- ORDER BY: sem ele, dois snapshots do mesmo item davam custos diferentes\n'
                '  -- em execuções idênticas.\n'
                '  SELECT consumption_snapshot, quantity INTO v_cons, v_snap_qty\n'
                '    FROM public.technical_sheet_snapshots\n'
                '   WHERE sale_order_id = v_sale_order_id\n'
                '     AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)\n'
                '     AND outdated_at IS NULL\n'
                '   ORDER BY frozen_at DESC NULLS LAST\n'
                '   LIMIT 1;\n'
                '\n'
                '  IF v_cons IS NULL AND EXISTS (\n'
                '       SELECT 1 FROM public.technical_sheet_snapshots\n'
                '        WHERE sale_order_id = v_sale_order_id\n'
                '          AND (sale_order_item_id IS NOT DISTINCT FROM v_item.id)\n'
                '          AND outdated_at IS NOT NULL)\n'
                '  THEN\n'
                '    v_cons_source := ''computed_snapshot_outdated'';\n'
                '    v_warnings := array_append(v_warnings, ''snapshot_desatualizado_ignorado'');\n'
                '  END IF;';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
    FROM pg_proc
   WHERE proname = 'calculate_order_cost_item'
     AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'calculate_order_cost_item não existe — abortando';
  END IF;

  IF position(v_old in v_def) = 0 THEN
    RAISE EXCEPTION
      'A leitura do snapshot não bateu literalmente — a função mudou desde 03/08/2026. Reveja à mão.';
  END IF;

  v_new := replace(v_def, v_old, v_fix);
  EXECUTE v_new;

  RAISE NOTICE 'calculate_order_cost_item: snapshot desatualizado deixa de custear';
END
$migration$;

-- ────────────────────────────────────────────────────────────────────────────
-- Diagnóstico permanente — par de consumption_consistency_report().
--
-- Existe porque o solado a R$ 0,00 passou despercebido de 11/07 a 03/08: o
-- custo saía errado em silêncio e nada na tela dizia que faltava cadastro.
--
-- ⚠ O check de duplicata é deliberadamente estreito. A primeira versão agrupava
-- só por nome de produto e acusou 102 falsos positivos: sandália com TIRA 1..
-- TIRA 6 do mesmo material, e napa usada em Cabedal E Forração — os dois são
-- consumo legítimo, somar está certo. Duplicata REAL é a mesma linha (produto +
-- componente + quantidade) repetida no mesmo item, e tiras ficam de fora porque
-- modelo com N tiras iguais é normal. Se alguém "melhorar" esse check afrouxando
-- o agrupamento, ele volta a gritar 102 vezes e o relatório perde credibilidade.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cost_consistency_report()
RETURNS TABLE (check_name text, severity text, item_count integer, sample text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Material usado em custeio sem preço → soma ZERO em silêncio.
  --    Foi assim que o solado INFANTIL/CARAMELO entrou de graça em 108 linhas.
  RETURN QUERY
  WITH usados AS (
    SELECT DISTINCT (mat ->> 'product_id')::uuid AS pid
      FROM public.order_costs oc, jsonb_array_elements(oc.breakdown -> 'materials') mat
     WHERE (mat ->> 'product_id') IS NOT NULL
  )
  SELECT 'material_sem_preco'::text, 'critical'::text, count(*)::integer,
         string_agg(p.name || COALESCE(' / ' || p.color, ''), ', ' ORDER BY p.name)
    FROM usados u JOIN public.products p ON p.id = u.pid
   WHERE COALESCE(p.unit_price, 0) = 0
  HAVING count(*) > 0;

  -- 2. Custo apoiado em snapshot já marcado desatualizado. Depois desta
  --    migration deveria ser sempre 0; se voltar, alguém reintroduziu a
  --    leitura sem filtro.
  RETURN QUERY
  SELECT 'custo_sobre_snapshot_desatualizado'::text, 'critical'::text, count(*)::integer,
         string_agg(DISTINCT so.order_number, ', ')
    FROM public.order_costs oc
    JOIN public.sale_orders so ON so.id = oc.sale_order_id
   WHERE oc.breakdown ->> 'consumption_source' = 'snapshot'
     AND EXISTS (
       SELECT 1 FROM public.technical_sheet_snapshots s
        WHERE s.sale_order_id = oc.sale_order_id
          AND (s.sale_order_item_id IS NOT DISTINCT FROM oc.sale_order_item_id)
          AND s.outdated_at IS NOT NULL)
  HAVING count(*) > 0;

  -- 3. Linha repetida na ficha (ver aviso acima sobre o agrupamento estreito).
  RETURN QUERY
  WITH dup AS (
    SELECT oc.sale_order_id, oc.id,
           mat ->> 'product_name' AS nome,
           mat ->> 'component'    AS comp,
           round((mat ->> 'required')::numeric, 4) AS req,
           count(*) AS vezes
      FROM public.order_costs oc, jsonb_array_elements(oc.breakdown -> 'materials') mat
     WHERE COALESCE(mat ->> 'component', '') <> 'Tira'
     GROUP BY 1, 2, 3, 4, 5
    HAVING count(*) > 1
  )
  SELECT 'linha_repetida_na_ficha'::text, 'warning'::text, count(*)::integer,
         string_agg(DISTINCT so.order_number || ' (' || d.nome || ' ' || d.vezes || 'x em ' || d.comp || ')', ', ')
    FROM dup d JOIN public.sale_orders so ON so.id = d.sale_order_id
  HAVING count(*) > 0;

  -- 4. Ficha sem operação cadastrada → mão de obra entra como zero.
  RETURN QUERY
  SELECT 'sem_operacoes_mo'::text, 'warning'::text, count(*)::integer,
         string_agg(DISTINCT so.order_number, ', ')
    FROM public.order_costs oc
    JOIN public.sale_orders so ON so.id = oc.sale_order_id
   WHERE oc.breakdown ->> 'labor_status' = 'sem_operacoes'
  HAVING count(*) > 0;

  -- 5. Custo por par acima do preço de venda — sinal de consumo inflado.
  RETURN QUERY
  SELECT 'custo_acima_do_preco'::text, 'critical'::text, count(*)::integer,
         string_agg(DISTINCT so.order_number || ' (R$ ' ||
                    round(oc.total_cost / NULLIF(oc.quantity, 0), 2) || '/par vs R$ ' ||
                    round(oc.revenue / NULLIF(oc.quantity, 0), 2) || ')', ', ')
    FROM public.order_costs oc
    JOIN public.sale_orders so ON so.id = oc.sale_order_id
   WHERE oc.revenue > 0 AND oc.total_cost > oc.revenue
  HAVING count(*) > 0;

  -- 6. Item sem NENHUMA embalagem: nem R$/par na política, nem caixa/fitilho no
  --    BOM. A embalagem é modelada pelo BOM de propósito (já respeita colmeia ×
  --    fitilho via filter_caixa_by_packaging_mode); a política fica em zero pra
  --    não contar duas vezes.
  RETURN QUERY
  SELECT 'embalagem_nao_configurada'::text, 'warning'::text, count(*)::integer,
         string_agg(DISTINCT so.order_number, ', ')
    FROM public.order_costs oc
    JOIN public.sale_orders so ON so.id = oc.sale_order_id
   WHERE COALESCE(oc.packaging_cost, 0) = 0
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(oc.breakdown -> 'materials') mat
        WHERE mat ->> 'product_name' ILIKE '%caixa%'
           OR mat ->> 'product_name' ILIKE '%fitilho%')
  HAVING count(*) > 0;

  -- 7. Unidade que o custeio não conseguiu converter → subtotal vira 0.
  RETURN QUERY
  SELECT 'unidade_nao_convertida'::text, 'critical'::text, count(*)::integer,
         string_agg(DISTINCT mat ->> 'product_name', ', ')
    FROM public.order_costs oc, jsonb_array_elements(oc.breakdown -> 'materials') mat
   WHERE mat ->> 'conversion_warning' = 'unit_mismatch'
  HAVING count(*) > 0;
END;
$$;

COMMENT ON FUNCTION public.cost_consistency_report() IS
  'Lacunas de cadastro que fazem o custo sair errado em silêncio. Par de '
  'consumption_consistency_report(). Exibido em /diagnostics → Consistência do custeio.';

GRANT EXECUTE ON FUNCTION public.cost_consistency_report() TO authenticated;
