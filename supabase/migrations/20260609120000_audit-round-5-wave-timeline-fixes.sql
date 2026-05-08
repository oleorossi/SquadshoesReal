-- =============================================================================
-- AUDITORIA ROUND 5 — Setores / Compras / Lead time / Capacidade / Ondas
-- =============================================================================
-- User: "Continuar auditoria completa, primeiro setor, planejamento de compras,
-- lead time, capacidade por setor, ondas. Quero que analise tudo em busca de
-- bugs e melhorias"
--
-- 🔴 BUGS CRÍTICOS ENCONTRADOS:
--
--   1. update_wave_timeline (DB function) referenciava orders.wave_id
--      mas essa coluna NÃO EXISTE. Todas ondas ficavam com timeline NULL
--      ao serem criadas/atualizadas. ✓ FIX: usa production_wave_items +
--      production_wave_item_sources (correto).
--
--   2. compute_wave_timeline (DB function) referenciava
--      default_lead_times.mesa_daily_capacity, mas essa coluna NÃO EXISTIA
--      em default_lead_times (só em technical_sheets). RAISE silenciava o
--      erro em código JS que chamava a função, mas em SQL direto disparava.
--      ✓ FIX: ALTER TABLE adiciona mesa_daily_capacity DEFAULT 350.
--
--   3. compute_wave_timeline referenciava technical_sheets.soling_capacity_per_day
--      que TAMBÉM NÃO EXISTIA. Sempre que ficha tinha "Solagem" no
--      production_sectors (após audit-round-3, TODAS), a função falhava.
--      ✓ FIX: ALTER TABLE adiciona soling_capacity_per_day.
--
--   4. 1 onda 'running' (W2026-19, 24 itens) sem timeline (NULL em todos
--      campos de start_date). ✓ FIX: recompute via update_wave_timeline
--      após corrigir bugs 1-3.
--
--   5. 8 fichas com shoe_category='Infantil' SEM default_lead_times
--      correspondente → cai em fallback hardcoded com leads conservadores.
--      ✓ FIX: INSERT 'Infantil' + 'Geral' (catch-all) em default_lead_times.
--
--   6. default_lead_times categorias antigas (Sandália/Tamanco/Sapato/Bota)
--      sem silk/gluing/soling/expedicao/mesa preenchidos.
--      ✓ FIX: UPDATE COALESCE com defaults razoáveis.
--
-- ✅ ÁREAS VALIDADAS OK:
--
--   - production_sectors em fichas: 100% canônicos (audit-round-3 limpou)
--   - get_wave_material_needs: usa p_sale_order_ids[], não tem o bug de update_*
--   - Setores em order_stages: distribuição consistente
--
-- 🟡 OBSERVAÇÕES (não-bugs, sugestões pra trabalho futuro):
--
--   - 100% das fichas SEM capacity_per_day próprio → todas usam defaults
--     da categoria. Funciona OK mas modelos com tempo atípico devem
--     preencher capacities específicos pra timeline mais precisa.
--
--   - 1 ficha com shoe_category='Rasteirinha' (maiúsculo) match com
--     'rasteirinha' (minúsculo) via LOWER() — case-insensitive lookup OK.
--
-- Aplicada em produção via Supabase MCP em 2026-05-08.
-- Resultado pós-fix: W2026-19 timeline preenchida (earliest_deadline 2026-04-09,
-- material_ready 2026-03-26, etapas calculadas corretamente).
-- =============================================================================

-- ─── #1 PRÉ-REQUISITOS: colunas que faltavam ───
ALTER TABLE public.default_lead_times
  ADD COLUMN IF NOT EXISTS mesa_daily_capacity integer DEFAULT 350;

ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS soling_capacity_per_day integer;

COMMENT ON COLUMN public.default_lead_times.mesa_daily_capacity IS
  'Capacidade diária do setor Mesa (pares/dia). Usado quando '
  'technical_sheets.mesa_daily_capacity é NULL.';

COMMENT ON COLUMN public.technical_sheets.soling_capacity_per_day IS
  'Capacidade diária do setor Solagem (pares/dia). NULL = usa default_lead_times.';

-- ─── #2 FIX: update_wave_timeline (usa production_wave_items, não orders.wave_id) ───
CREATE OR REPLACE FUNCTION public.update_wave_timeline(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  v_sale_order_ids uuid[];
  v_tl record;
BEGIN
  SELECT array_agg(DISTINCT pwis.sale_order_id) INTO v_sale_order_ids
  FROM public.production_wave_items pwi
  JOIN public.production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
  WHERE pwi.wave_id = p_wave_id
    AND pwis.sale_order_id IS NOT NULL;

  IF v_sale_order_ids IS NULL OR array_length(v_sale_order_ids, 1) = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_tl FROM public.compute_wave_timeline(v_sale_order_ids) LIMIT 1;

  UPDATE public.production_waves SET
    earliest_deadline           = v_tl.earliest_deadline,
    purchase_deadline           = v_tl.purchase_deadline,
    material_ready_date         = v_tl.material_ready_date,
    corte_palmilha_start_date   = v_tl.corte_palmilha_start_date,
    corte_forracao_start_date   = v_tl.corte_forracao_start_date,
    costura_start_date          = v_tl.costura_start_date,
    mesa_start_date             = v_tl.mesa_start_date,
    silk_start_date             = v_tl.silk_start_date,
    colagem_start_date          = v_tl.colagem_start_date,
    montagem_start_date         = v_tl.montagem_start_date,
    solagem_start_date          = v_tl.solagem_start_date,
    acabamento_start_date       = v_tl.acabamento_start_date,
    updated_at                  = now()
  WHERE id = p_wave_id;
END;
$$;
COMMENT ON FUNCTION public.update_wave_timeline IS
  'Recalcula timeline de uma onda. Usa production_wave_items + sources. '
  'Antes referenciava orders.wave_id (bug fixed audit-round-5).';

-- ─── #3 default_lead_times: Infantil + Geral ───
INSERT INTO public.default_lead_times (
  shoe_category, lead_time_corte_dias, lead_time_costura_dias,
  lead_time_montagem_dias, lead_time_acabamento_dias, lead_time_buffer_material_dias,
  cutting_capacity_per_day, sewing_capacity_per_day, costura_capacity_per_day,
  mesa_daily_capacity,
  assembly_capacity_per_day, finishing_capacity_per_day,
  silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day,
  lead_time_silk_dias, lead_time_colagem_dias, lead_time_expedicao_dias, notes
)
SELECT 'Infantil', 1, 1, 2, 1, 2,
       500, 550, 550, 400, 350, 550,
       400, 550, 500, 1, 1, 2,
       'Padrão calçados infantis'
WHERE NOT EXISTS (SELECT 1 FROM public.default_lead_times WHERE LOWER(shoe_category) = 'infantil');

INSERT INTO public.default_lead_times (
  shoe_category, lead_time_corte_dias, lead_time_costura_dias,
  lead_time_montagem_dias, lead_time_acabamento_dias, lead_time_buffer_material_dias,
  cutting_capacity_per_day, sewing_capacity_per_day, costura_capacity_per_day,
  mesa_daily_capacity,
  assembly_capacity_per_day, finishing_capacity_per_day,
  silk_capacity_per_day, gluing_capacity_per_day, soling_capacity_per_day,
  lead_time_silk_dias, lead_time_colagem_dias, lead_time_expedicao_dias, notes
)
SELECT 'Geral', 2, 2, 3, 2, 2,
       400, 450, 450, 350, 280, 450,
       350, 450, 400, 1, 1, 2,
       'Catch-all pra fichas sem categoria específica'
WHERE NOT EXISTS (SELECT 1 FROM public.default_lead_times WHERE LOWER(shoe_category) = 'geral');

-- ─── #4 Completa silk/gluing/soling/mesa em categorias antigas ───
UPDATE public.default_lead_times SET
  silk_capacity_per_day    = COALESCE(silk_capacity_per_day, 350),
  gluing_capacity_per_day  = COALESCE(gluing_capacity_per_day, 450),
  soling_capacity_per_day  = COALESCE(soling_capacity_per_day, 400),
  mesa_daily_capacity      = COALESCE(mesa_daily_capacity, 350),
  lead_time_silk_dias      = COALESCE(lead_time_silk_dias, 1),
  lead_time_colagem_dias   = COALESCE(lead_time_colagem_dias, 1),
  lead_time_expedicao_dias = COALESCE(lead_time_expedicao_dias, 2);

-- ─── #5 Recompute timeline em waves não-canceladas com NULL ───
DO $$
DECLARE v_wave RECORD;
BEGIN
  FOR v_wave IN
    SELECT id FROM public.production_waves
    WHERE status NOT IN ('cancelled', 'finished')
      AND (earliest_deadline IS NULL OR material_ready_date IS NULL)
  LOOP
    BEGIN
      PERFORM public.update_wave_timeline(v_wave.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'update_wave_timeline falhou pra wave %: %', v_wave.id, SQLERRM;
    END;
  END LOOP;
END $$;
