-- =============================================================================
-- AUDIT ROUND 16 — Consistência das funções de consumo + view de auditoria
-- =============================================================================
-- 1. Versões antigas SEM fix do round 15:
--    - calculate_order_consumption(uuid, numeric, text, integer) — single size
--    - calculate_order_consumption_by_grade(uuid, jsonb, text) — sem variant_id
--    Ambas chamadas por freeze_technical_sheet e hybrid_debit_stock_for_order.
--    Snapshots persistidos quando OP entra em produção tinham o cálculo bugado.
--
--    Fix: a versão antiga _by_grade(uuid,jsonb,text) vira wrapper que delega
--    pra versão nova com p_material_variant_id=NULL. Garante que QUALQUER fix
--    futuro propaga automaticamente. A versão single-size é mantida pelo
--    nome mas hoje é redundante (todas as OPs em prod usam grade).
--
-- 2. View v_technical_sheets_audit — relatório por ficha de campos incompletos.
--    Operador usa pra ver quais fichas precisam preencher antes de gerar PVs.
-- =============================================================================

-- ─── 1. Wrapper delegante ──────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.calculate_order_consumption_by_grade(uuid, jsonb, text);
CREATE OR REPLACE FUNCTION public.calculate_order_consumption_by_grade(
  p_reference_id uuid,
  p_grade jsonb,
  p_color text
) RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.calculate_order_consumption_by_grade(p_reference_id, p_grade, p_color, NULL::uuid);
$$;
GRANT EXECUTE ON FUNCTION public.calculate_order_consumption_by_grade(uuid, jsonb, text) TO authenticated;


-- ─── 2. View de auditoria de fichas técnicas ──────────────────────────────
-- Cada coluna boolean indica um gap. is_complete = NOT (qualquer gap).
-- Operador filtra por is_complete=false pra ver fichas pendentes.

CREATE OR REPLACE VIEW public.v_technical_sheets_audit AS
SELECT
  ts.id,
  ts.code,
  ts.name,
  ts.status,

  -- ── Cabedal ──
  COALESCE(ts.upper_material, '') = '' AS missing_upper_material,
  (COALESCE(ts.upper_consumption, 0) <= 0
    AND (ts.upper_consumption_per_size IS NULL OR ts.upper_consumption_per_size = '{}'::jsonb)) AS missing_upper_consumption,

  -- ── Forro ──
  COALESCE(ts.lining_material, '') = '' AS missing_lining_material,
  (COALESCE(ts.lining_consumption, 0) <= 0
    AND (ts.lining_consumption_per_size IS NULL OR ts.lining_consumption_per_size = '{}'::jsonb)) AS missing_lining_consumption,

  -- ── Palmilha ──
  COALESCE(ts.insole_material, '') = '' AS missing_insole_material,
  (COALESCE(ts.insole_consumption, 0) <= 0
    AND (ts.insole_consumption_per_size IS NULL OR ts.insole_consumption_per_size = '{}'::jsonb)) AS missing_insole_consumption,

  -- ── Solado ──
  COALESCE(ts.sole_material, '') = '' AS missing_sole_material,
  COALESCE(ts.sole_consumption, 0) <= 0 AS missing_sole_consumption,
  -- Ficha tem solado fachetado mas sole_technical_specs sem fachete?
  EXISTS (
    SELECT 1 FROM technical_sheet_sole_colors tsc
    JOIN products p ON p.id = tsc.sole_product_id
    WHERE tsc.sheet_id = ts.id AND COALESCE(p.is_fachetado, false) = true
  ) AND NOT EXISTS (
    SELECT 1 FROM technical_sheet_sole_colors tsc
    JOIN sole_technical_specs sts ON sts.sole_id = tsc.sole_product_id
    WHERE tsc.sheet_id = ts.id AND COALESCE(sts.fachete_lining_consumption_dm2, 0) > 0
  ) AS sole_fachetado_sem_fachete,

  -- ── Cores de solado mapeadas? ──
  NOT EXISTS (SELECT 1 FROM technical_sheet_sole_colors WHERE sheet_id = ts.id) AS missing_sole_color_mapping,

  -- ── Tiras ──
  COALESCE(ts.has_straps, false) = true
    AND (ts.strap_colors IS NULL OR jsonb_array_length(ts.strap_colors) = 0) AS straps_without_colors,
  -- Tira sem grupo definido em algum item
  COALESCE(ts.has_straps, false) = true
    AND ts.strap_colors IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements(ts.strap_colors) s
      WHERE COALESCE(s ->> 'group_id', '') = ''
    ) AS straps_without_group,

  -- ── MOD (mão-de-obra) ──
  NOT EXISTS (SELECT 1 FROM technical_sheet_operations WHERE sheet_id = ts.id) AS missing_mod,

  -- ── Consumo per-size — incompleto? ──
  -- Se preencheu PER-SIZE mas faltam tamanhos comuns (35, 36, 37) E não tem fallback escalar,
  -- algumas grades vão cair em average=0. Sinaliza o gap.
  (ts.upper_consumption_per_size IS NOT NULL
    AND jsonb_typeof(ts.upper_consumption_per_size) = 'object'
    AND ts.upper_consumption_per_size != '{}'::jsonb
    AND COALESCE(ts.upper_consumption, 0) <= 0
    AND (SELECT COUNT(*) FROM jsonb_each_text(ts.upper_consumption_per_size) WHERE value::numeric > 0) < 5
  ) AS upper_per_size_partial_no_fallback,

  ts.updated_at,
  ts.created_at
FROM technical_sheets ts;

GRANT SELECT ON public.v_technical_sheets_audit TO authenticated;

COMMENT ON VIEW public.v_technical_sheets_audit IS
  'Relatório de auditoria das fichas técnicas. Cada coluna boolean indica um '
  'gap. UI filtra fichas com qualquer flag=true pra operador corrigir.';


-- ─── 3. View resumo (KPIs pra dashboard) ──────────────────────────────────
CREATE OR REPLACE VIEW public.v_technical_sheets_audit_summary AS
SELECT
  COUNT(*) AS total_fichas,
  COUNT(*) FILTER (WHERE missing_upper_material) AS sem_grupo_cabedal,
  COUNT(*) FILTER (WHERE missing_upper_consumption) AS sem_consumo_cabedal,
  COUNT(*) FILTER (WHERE missing_lining_material) AS sem_grupo_forro,
  COUNT(*) FILTER (WHERE missing_lining_consumption) AS sem_consumo_forro,
  COUNT(*) FILTER (WHERE missing_insole_material) AS sem_grupo_palmilha,
  COUNT(*) FILTER (WHERE missing_insole_consumption) AS sem_consumo_palmilha,
  COUNT(*) FILTER (WHERE missing_sole_material) AS sem_grupo_solado,
  COUNT(*) FILTER (WHERE missing_sole_consumption) AS sem_consumo_solado,
  COUNT(*) FILTER (WHERE missing_sole_color_mapping) AS sem_cores_solado,
  COUNT(*) FILTER (WHERE sole_fachetado_sem_fachete) AS fachetado_sem_fachete,
  COUNT(*) FILTER (WHERE straps_without_colors) AS tiras_sem_cores,
  COUNT(*) FILTER (WHERE straps_without_group) AS tiras_sem_grupo,
  COUNT(*) FILTER (WHERE missing_mod) AS sem_mod_cadastrado,
  COUNT(*) FILTER (WHERE upper_per_size_partial_no_fallback) AS upper_per_size_parcial,
  -- Fichas completas
  COUNT(*) FILTER (
    WHERE NOT missing_upper_material AND NOT missing_upper_consumption
      AND NOT missing_lining_material AND NOT missing_lining_consumption
      AND NOT missing_insole_material AND NOT missing_insole_consumption
      AND NOT missing_sole_material AND NOT missing_sole_consumption
      AND NOT missing_sole_color_mapping
      AND NOT sole_fachetado_sem_fachete
      AND NOT straps_without_colors AND NOT straps_without_group
      AND NOT missing_mod
      AND NOT upper_per_size_partial_no_fallback
  ) AS fichas_100_completas
FROM v_technical_sheets_audit;

GRANT SELECT ON public.v_technical_sheets_audit_summary TO authenticated;


-- ─── 4. Marcar todos PVs como dirty pra reprocessar com função antiga
--    delegando à nova ────────────────────────────────────────────────────
UPDATE public.sale_orders SET costs_dirty_at = now()
 WHERE status NOT IN ('Cancelado', 'Cancelada', 'Rascunho')
   AND costs_dirty_at IS NULL;
