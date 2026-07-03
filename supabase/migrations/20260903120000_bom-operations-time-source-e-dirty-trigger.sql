-- P0.1 / M1 (PRD Avaliação de Necessidade 2026-07-03) — proveniência do tempo de MO
-- + recálculo automático ao editar operações.
--
-- Problema 1: bom_operations não distingue linha gerada de linha editada à mão.
-- generate_bom_operations() (20260628181500) faz DELETE global ao re-rodar, então
-- qualquer regeneração apagaria edições manuais e resultados de cronoanálise. A
-- coluna time_source dá o marcador que o generator v2 (migration seguinte) usa
-- para preservar 'manual' e 'cronoanalise'.
--
-- Problema 2: editar tempo/custo/active em bom_operations NÃO marcava
-- sale_orders.costs_dirty_at — o labor é lido VIVO pelo calculate_order_cost_item,
-- mas nada redisparava o recálculo (order_costs ficava velho até algo mais tocar
-- o PV). Espelha tg_mark_so_costs_dirty_from_bom (sheet_materials, 20260830130000),
-- porém SEM invalidar snapshot/reservas: snapshot congela só consumo de material,
-- e MO não mexe em reserva de estoque.

-- 1) Coluna de proveniência do tempo
ALTER TABLE public.bom_operations
  ADD COLUMN IF NOT EXISTS time_source text NOT NULL DEFAULT 'manual'
  CHECK (time_source IN ('capacidade','default','cronoanalise','manual','pendente'));

COMMENT ON COLUMN public.bom_operations.time_source IS
  'Proveniência do tempo-padrão: capacidade (jornada÷capacidade da ficha) | default (sector_minutes_default) | cronoanalise (apply_time_study_to_bom) | manual (editado na UI) | pendente (sem fonte, active=false). generate_bom_operations v2 só sobrescreve capacidade/default/pendente.';

-- 2) Backfill defensivo pela convenção de notes do generator v1.
--    Na dúvida, classifica como 'manual' — manual nunca é sobrescrito pelo generator.
UPDATE public.bom_operations SET time_source = CASE
  WHEN notes = 'fonte_capacidade'                                       THEN 'capacidade'
  WHEN notes = 'fonte_default'                                          THEN 'default'
  WHEN notes = 'tempo_pendente' AND COALESCE(standard_time_minutes,0)=0 THEN 'pendente'
  WHEN notes = 'tempo_pendente' AND standard_time_minutes > 0           THEN 'manual'
  WHEN notes = 'Gerado por cronoanálise'                                THEN 'cronoanalise'
  ELSE 'manual'
END;

-- Auditoria manual (rodar à parte se quiser revisar as linhas com tempo>0 cuja
-- classificação 'capacidade' pode na verdade ser edição humana):
--   SELECT b.id, ts.reference_code, b.stage, b.standard_time_minutes, b.cost_per_hour
--     FROM bom_operations b JOIN technical_sheets ts ON ts.id = b.sheet_id
--    WHERE b.time_source = 'capacidade' AND b.standard_time_minutes > 0;

-- 3) Trigger: qualquer mudança de tempo/custo/ativação re-marca os PVs como dirty.
--    O freeze de PVs terminais fica por conta do process_dirty_order_costs (H3).
CREATE OR REPLACE FUNCTION public.tg_mark_so_costs_dirty_from_bom_ops()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_sheet uuid := COALESCE(NEW.sheet_id, OLD.sheet_id);
BEGIN
  IF v_sheet IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.sale_orders so
     SET costs_dirty_at = now()
   WHERE so.id IN (
     SELECT DISTINCT soi.sale_order_id
       FROM public.sale_order_items soi
      WHERE soi.reference_id = v_sheet
   )
     AND so.status NOT IN ('Cancelado', 'Cancelada', 'Rascunho');

  RETURN COALESCE(NEW, OLD);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tg_mark_so_costs_dirty_from_bom_ops() FROM public, anon;

DROP TRIGGER IF EXISTS trg_mark_so_costs_dirty_from_bom_ops ON public.bom_operations;
CREATE TRIGGER trg_mark_so_costs_dirty_from_bom_ops
  AFTER INSERT OR DELETE OR UPDATE OF standard_time_minutes, cost_per_hour, active
  ON public.bom_operations
  FOR EACH ROW EXECUTE FUNCTION public.tg_mark_so_costs_dirty_from_bom_ops();

-- 4) Cronoanálise passa a carimbar a proveniência (reassert de 20260630120000,
--    única mudança: time_source='cronoanalise' no INSERT e no UPDATE).
CREATE OR REPLACE FUNCTION public.apply_time_study_to_bom(p_study_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_study public.time_studies%ROWTYPE;
  v_op_id uuid;
BEGIN
  SELECT * INTO v_study FROM public.time_studies WHERE id = p_study_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cronoanálise % não encontrada', p_study_id;
  END IF;

  v_op_id := v_study.bom_operation_id;

  IF v_op_id IS NULL THEN
    SELECT id INTO v_op_id
      FROM public.bom_operations
     WHERE sheet_id = v_study.sheet_id
       AND operation_name = v_study.operation_name
       AND stage = v_study.stage
     LIMIT 1;
  END IF;

  IF v_op_id IS NULL THEN
    INSERT INTO public.bom_operations
      (sheet_id, operation_name, stage, standard_time_minutes, cost_per_hour, notes, time_source)
    VALUES
      (v_study.sheet_id, v_study.operation_name, v_study.stage,
       v_study.standard_time_minutes, v_study.cost_per_hour,
       'Gerado por cronoanálise', 'cronoanalise')
    RETURNING id INTO v_op_id;
  ELSE
    UPDATE public.bom_operations
       SET standard_time_minutes = v_study.standard_time_minutes,
           cost_per_hour = v_study.cost_per_hour,
           time_source = 'cronoanalise',
           updated_at = now()
     WHERE id = v_op_id;
  END IF;

  UPDATE public.time_studies SET bom_operation_id = v_op_id WHERE id = p_study_id;

  RETURN v_op_id;
END;
$$;
