-- Keystone PCP (2026-06-25): carimbo automático de timestamps de WIP em
-- order_stages, INDEPENDENTE de qual caminho grava (botões das telas de setor,
-- SectorStageDialog, Kanban, baixa em lote, resync, SQL).
--
-- Motivo: auditoria do chão de fábrica mostrou que 96% das etapas concluídas
-- (1465 de 1517) NÃO tinham started_at e ~28% não tinham completed_at — a
-- conclusão acontecia pulando 'em_andamento' (baixa direta), então nunca se
-- capturava o início. Sem started_at/completed_at não há lead time real, idade
-- de fila (gargalo) nem planejado×real — os KPIs de atraso ficavam cegos
-- (ver src/lib/sectorBottleneck.ts, que exige started_at).
--
-- Estratégia ADITIVA e não-destrutiva: só preenche quando está NULL (valor
-- vindo do app sempre vence) e NUNCA rejeita transição — a rejeição de
-- sequência já é feita por fn_guard_manual_stage_transition (pendente→em_andamento
-- exige pré-requisitos). Aqui só garantimos o timestamp.
--   • ao SAIR de 'pendente' (iniciar OU concluir direto) → started_at = now() se nulo
--   • ao entrar em estado de conclusão → completed_at = now() se nulo
-- Reverter para 'pendente' (Kanban arrastar de volta zera started_at) não é
-- tocado (a condição OLD.status='pendente' não casa).

CREATE OR REPLACE FUNCTION public.tg_stamp_order_stage_wip_timestamps()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'pendente'
       AND NEW.status <> 'pendente'
       AND NEW.started_at IS NULL THEN
      NEW.started_at := now();
    END IF;
    IF NEW.status IN ('concluido', 'concluído', 'completed', 'done', 'pronto')
       AND NEW.completed_at IS NULL THEN
      NEW.completed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Nome 'tg_...' ordena antes de 'trg_guard_manual_stage_transition' nos BEFORE
-- triggers; como só setamos campos de NEW (e o guard pode RAISE, abortando a
-- transação inteira), a ordem é inofensiva de qualquer forma.
DROP TRIGGER IF EXISTS tg_stamp_order_stage_wip_timestamps ON public.order_stages;
CREATE TRIGGER tg_stamp_order_stage_wip_timestamps
  BEFORE UPDATE ON public.order_stages
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_stamp_order_stage_wip_timestamps();
