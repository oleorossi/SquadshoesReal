-- Pulo/avançamento parcial: o predecessor não precisa estar concluído.
--
-- Em produção, fn_guard_manual_stage_transition (versão "predecessor simples")
-- barrava pendente → em_andamento quando o setor anterior ainda estava
-- em_andamento. Ao apontar 276/900 em Palmilha · Fibra e pular Palmilha ·
-- Forração (OP-2026-06199), o skip tentava iniciar a Forração e recebia:
--   Setor "Palmilha · Forração": não pode iniciar porque o setor anterior
--   "Palmilha · Fibra" não está finalizado (status atual: em_andamento).
--
-- A regra nova: o predecessor libera o próximo setor se já estiver concluído
-- (inclusive pulado com 0) OU se já tiver entregue pares (parcial). O limite
-- de quantidade do apontamento continua impedindo apontar no destino mais do
-- que a origem entregou. Setor anterior zerado e ainda não iniciado segue
-- bloqueando.
--
-- Timestamp DEPOIS de 20270101066200 (e 66300 reservado no PR #751).

CREATE OR REPLACE FUNCTION public.fn_guard_manual_stage_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prev_order      integer;
  v_prev_stage_name text;
  v_prev_status     text;
  v_prev_processed  integer;
BEGIN
  -- Only enforce pendente → em_andamento transitions
  IF NEW.status <> 'em_andamento' OR OLD.status <> 'pendente' THEN
    RETURN NEW;
  END IF;

  -- Find the immediately preceding stage for this order
  SELECT stage_order, stage_name
    INTO v_prev_order, v_prev_stage_name
  FROM public.order_stages
  WHERE order_id = NEW.order_id
    AND stage_order < NEW.stage_order
  ORDER BY stage_order DESC
  LIMIT 1;

  -- No predecessor → first stage, always allowed
  IF v_prev_order IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status, COALESCE(quantity_processed, 0)
    INTO v_prev_status, v_prev_processed
  FROM public.order_stages
  WHERE order_id = NEW.order_id
    AND stage_order = v_prev_order;

  -- Concluído (produção total ou pulo com 0) OU parcial já entregue libera.
  IF v_prev_status IS DISTINCT FROM 'concluido'
     AND COALESCE(v_prev_processed, 0) <= 0 THEN
    RAISE EXCEPTION 'Setor "%": não pode iniciar porque o setor anterior "%" não está finalizado (status atual: %).',
      NEW.stage_name, v_prev_stage_name, COALESCE(v_prev_status, 'desconhecido');
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_guard_manual_stage_transition() IS
  'Libera pendente→em_andamento quando o predecessor está concluído ou já entregou pares (apontamento parcial / pulo de setor). Bloqueia só se o anterior ainda não iniciou (0 pares).';
