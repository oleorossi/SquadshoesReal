-- =============================================================================
-- ENGINE DE CAPACIDADE — fixes do review adversarial 2026-07-19.
--
-- (As correções nas funções get_model_productivity / capacity_consistency_report
-- foram feitas IN-PLACE nos arquivos 20260719120000/20260719120100 — ordem
-- warning×override da MO, erro claro pra não-aprovado, clamp do seed, categorias
-- operacao_orfa + headcount_drift — e re-aplicadas via MCP. Este arquivo traz o
-- que é objeto NOVO:)
--
--   • tg_capacity_parameters_updated_by — updated_by tinha DEFAULT auth.uid()
--     que só vale no INSERT (o seed roda como postgres → NULL) e o UPDATE do
--     service não seta a coluna. Trigger carimba autoria server-side.
--   • update_sector_headcounts(jsonb) — gravação ATÔMICA da Equipe: o dialog
--     salvava em loop (1 UPDATE por setor); falha no meio deixava escrita
--     parcial e cada UPDATE disparava o recompute do motor de produção. Uma
--     transação só resolve os dois. SECURITY INVOKER — a RLS de sector_settings
--     (approved_update) continua sendo o gate.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.capacity_set_updated_by()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_by := auth.uid();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_capacity_parameters_updated_by ON public.capacity_parameters;
CREATE TRIGGER tg_capacity_parameters_updated_by
  BEFORE UPDATE ON public.capacity_parameters
  FOR EACH ROW EXECUTE FUNCTION public.capacity_set_updated_by();

CREATE OR REPLACE FUNCTION public.update_sector_headcounts(p_headcounts jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_headcounts IS NULL OR jsonb_typeof(p_headcounts) <> 'object' THEN
    RAISE EXCEPTION 'p_headcounts deve ser um objeto {setor: headcount}';
  END IF;

  -- Valida TUDO antes de escrever (tudo-ou-nada; espelha assertHeadcount do service).
  IF EXISTS (
    SELECT 1 FROM jsonb_each(p_headcounts) e
     WHERE e.value <> 'null'::jsonb
       AND (jsonb_typeof(e.value) <> 'number' OR (e.value #>> '{}')::numeric < 0)
  ) THEN
    RAISE EXCEPTION 'headcount inválido: use números >= 0 (ou null pra limpar)';
  END IF;

  UPDATE sector_settings ss
     SET headcount = CASE WHEN e.value = 'null'::jsonb THEN NULL
                          ELSE (e.value #>> '{}')::numeric END
    FROM jsonb_each(p_headcounts) e
   WHERE ss.sector = e.key;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.update_sector_headcounts(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_sector_headcounts(jsonb) TO authenticated, service_role;
