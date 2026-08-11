-- ════════════════════════════════════════════════════════════════════════════
-- Corte Palmilha ganha coluna própria de capacidade na ficha técnica.
--
-- O CADASTRO ESTAVA ERRADO: `sector_settings` mandava o Corte Palmilha ler
-- `sewing_capacity_per_day` — a coluna da COSTURA — enquanto o Corte Forração
-- lia `cutting_capacity_per_day`. Confirmado pelo dono como troca de coluna.
--
-- ⚠ Por que criar coluna em vez de apontar para `cutting`: medido em 11/08/2026,
-- 9 fichas têm `sewing` preenchida e só 3 têm `cutting`. Redirecionar para
-- `cutting` faria **8 fichas perderem o override** e caírem no default de 600
-- pares/dia, replanejando **18 OPs abertas**. A coluna própria não degrada
-- plano nenhum hoje e separa os dois cortes de vez.
--
-- ⚠⚠ A ARMADILHA DESTA MUDANÇA: `recompute_production_schedule` resolve a
-- capacidade da ficha por um CASE com nomes de coluna HARDCODED. Apontar
-- `sector_settings` para uma coluna que o CASE não conhece cai no ELSE NULL e
-- usa o default global — ou seja, o cadastro pareceria certo e o plano estaria
-- errado, sem erro nenhum. Por isso a função é alterada JUNTO, e por
-- substituição ancorada com asserção: se a âncora não bater, a migration ABORTA
-- em vez de aplicar metade.
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. A coluna ─────────────────────────────────────────────────────────────
ALTER TABLE public.technical_sheets
  ADD COLUMN IF NOT EXISTS corte_palmilha_capacity_per_day integer;

COMMENT ON COLUMN public.technical_sheets.corte_palmilha_capacity_per_day IS
  'Capacidade diária do setor Corte Palmilha para esta referência (pares/dia). '
  'Nasce NULL: enquanto não preenchida, o motor cai em cutting_capacity_per_day '
  'e, na falta dela, no default de sector_settings.';

-- ── 2. O motor passa a conhecer a coluna ────────────────────────────────────
DO $patch$
DECLARE
  v_def  text;
  v_ancora_select text := 'ts.finishing_capacity_per_day, ts.expedition_capacity_per_day';
  v_ancora_case   text := 'WHEN ''cutting_capacity_per_day''    THEN NULLIF(COALESCE(f.cutting_capacity_per_day, 0), 0)';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'recompute_production_schedule';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'recompute_production_schedule não encontrada';
  END IF;

  -- Já aplicado? (idempotência)
  IF position('corte_palmilha_capacity_per_day' in v_def) > 0 THEN
    RAISE NOTICE 'motor já conhece corte_palmilha_capacity_per_day — nada a fazer';
    RETURN;
  END IF;

  IF position(v_ancora_select in v_def) = 0 THEN
    RAISE EXCEPTION 'âncora do SELECT da CTE ficha não encontrada — a função mudou, revise o patch';
  END IF;
  IF position(v_ancora_case in v_def) = 0 THEN
    RAISE EXCEPTION 'âncora do CASE de capacidade não encontrada — a função mudou, revise o patch';
  END IF;

  -- 2a. a CTE `ficha` passa a trazer a coluna nova
  v_def := replace(
    v_def,
    v_ancora_select,
    v_ancora_select || ',' || E'\n           ts.corte_palmilha_capacity_per_day'
  );

  -- 2b. o CASE ganha o ramo, com FALLBACK em `cutting` — mesmo padrão que o
  --     split da Costura (M16) já usa: enquanto a ficha não tiver a coluna
  --     nova preenchida, o setor continua com o número que tinha sentido.
  v_def := replace(
    v_def,
    v_ancora_case,
    v_ancora_case || E'\n' ||
    '             WHEN ''corte_palmilha_capacity_per_day'' THEN COALESCE(' || E'\n' ||
    '               NULLIF(COALESCE(f.corte_palmilha_capacity_per_day, 0), 0),' || E'\n' ||
    '               NULLIF(COALESCE(f.cutting_capacity_per_day, 0), 0))'
  );

  EXECUTE v_def;
END
$patch$;

-- ── 3. O cadastro aponta para a coluna certa ────────────────────────────────
UPDATE public.sector_settings
   SET ficha_capacity_column = 'corte_palmilha_capacity_per_day',
       updated_at = now()
 WHERE sector = 'Corte Palmilha'
   AND ficha_capacity_column = 'sewing_capacity_per_day';
