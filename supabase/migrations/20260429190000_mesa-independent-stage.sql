-- Mesa: setor independente, inicia com a onda, não bloqueia Palmilha/Costura
--
-- Mesa está no nível 2 junto com Palmilha e Costura, MAS é iniciada
-- pelo start_wave simultaneamente ao Corte (nível 1).
--
-- Resultado:
--   start_wave      → Corte(1) inicia E Mesa(2) inicia imediatamente
--   Corte termina   → Palmilha(2) e Costura(2) iniciam
--                     (Mesa pode ainda estar em execução — não bloqueia)
--   Mesa+Palmi+Costu terminam (qualquer ordem) → Montagem(3) inicia
--
-- Por que funciona:
--   advance_wave_stage ao terminar Corte(1): verifica se todos os ord=1
--   estão prontos → só Corte está no ord=1 → inicia TODOS os pendentes
--   do ord=2 (Palmilha e Costura). Mesa já está in_progress desde
--   start_wave, portanto não está 'pending' e não é reiniciada.
--   Quando o último entre Mesa/Palmilha/Costura terminar: todos ord=2
--   estão completos → inicia Montagem(3).
--
-- Changes:
--   1. stage_order(): mesa = 2 (era 1)
--   2. start_wave(): inicia ord=1 E 'mesa' especificamente

-- ── 1. stage_order ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stage_order(s production_stage_enum)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE s
    WHEN 'corte'      THEN 1
    WHEN 'mesa'       THEN 2  -- inicia com a onda, termina antes da montagem
    WHEN 'palmilha'   THEN 2  -- inicia após corte, paralelo com costura e mesa
    WHEN 'costura'    THEN 2  -- inicia após corte, paralelo com palmilha e mesa
    WHEN 'montagem'   THEN 3  -- aguarda mesa + palmilha + costura
    WHEN 'solagem'    THEN 4
    WHEN 'acabamento' THEN 5
  END;
$$;

-- ── 2. start_wave — inicia Corte (ord=1) e Mesa imediatamente ──────────────────
CREATE OR REPLACE FUNCTION public.start_wave(p_wave_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_now           timestamptz := now();
  v_first_stage   production_stage_enum;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Autenticação necessária';
  END IF;

  -- Inicia estágios de nível 1 (Corte) + Mesa (independente, começa junto)
  UPDATE production_wave_stages
     SET status      = 'in_progress',
         operator_id = COALESCE(operator_id, auth.uid()),
         started_at  = v_now,
         updated_at  = v_now
   WHERE wave_id = p_wave_id
     AND status = 'pending'
     AND (stage_order(stage) = 1 OR stage = 'mesa');

  -- current_stage aponta para o primeiro estágio iniciado (Corte)
  SELECT stage INTO v_first_stage
    FROM production_wave_stages
   WHERE wave_id = p_wave_id
     AND stage_order(stage) = 1
     AND status = 'in_progress'
   ORDER BY stage
   LIMIT 1;

  UPDATE production_waves
     SET status        = 'running',
         current_stage  = v_first_stage,
         started_at     = COALESCE(started_at, v_now)
   WHERE id = p_wave_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_wave(uuid) TO authenticated;
