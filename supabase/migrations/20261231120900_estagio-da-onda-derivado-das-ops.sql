-- ════════════════════════════════════════════════════════════════════════════
-- O estágio da onda passa a ser DERIVADO das OPs (Q1/Q13 do grill-me).
--
-- Medido em 11/08/2026: as CINCO ondas "running" mentiam.
--
--   onda        dizia            OPs  etapas  concluídas  status das OPs
--   4d23c028    corte_palmilha     4     288         288  Finalizado
--   56c2b4ac    corte_palmilha     2      40          40  Finalizado
--   6dad97e7    corte              8     392         392  Finalizado
--   a3d78412    corte              0       0           0  (órfã)
--   dc55d045    corte              6    2520           0  Em Produção
--
-- Três diziam estar no Corte com 100% das etapas concluídas e as OPs
-- Finalizadas — a produção acabou e o quadro nunca avançou. Uma está rodando
-- com zero OPs. `production_wave_stages` é uma máquina de estado PARALELA que
-- ninguém aponta (o Kanban move `order_stages`), e nada reconcilia as duas.
--
-- REGRA (Q13=a): estágio = MENOR etapa ainda não concluída entre as OPs da onda.
-- Sem etapa aberta = concluída. Sem OP = inválida — e não "no Corte", que é o
-- que faz a órfã parecer que está produzindo.
--
-- ⚠ POR QUE ADITIVO E NÃO REMOÇÃO: **11 funções SQL** ainda leem
-- `production_wave_stages` (start_wave, advance_wave_stage, sync_wave_from_kanban,
-- create_*_wave, register_defect_and_adjust_wave, fn_guard_wave_stage_transition…).
-- Renomear a tabela agora quebraria as onze de uma vez. Esta migration entrega o
-- que o dono precisa — o quadro parar de mentir — sem reescrever as 11 no escuro.
-- A remoção fica para um lote próprio, depois de rodar com o derivado à vista.
--
-- ⚠ NÃO usei `kanban_stage_to_wave_stage`: ela mapeia para um vocabulário ANTIGO
-- e devolve NULL para os setores atuais (Corte Palmilha, Corte Forração, Costura
-- Palmilha, Costura Cabedal) — 4 dos 11, e os mais movimentados. Além disso manda
-- 'Expedição' para 'acabamento'. O derivado usa o nome real de `order_stages`.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.wave_derived_progress(p_wave_id uuid)
RETURNS TABLE (
  sector          text,
  situacao        text,     -- 'em_producao' | 'concluida' | 'sem_op'
  ops             integer,
  etapas_abertas  integer,
  pares_abertos   integer
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  WITH ops_da_onda AS (
    SELECT DISTINCT o.id
      FROM public.production_wave_items pwi
      JOIN public.production_wave_item_sources pwis ON pwis.wave_item_id = pwi.id
      JOIN public.orders o ON o.sale_order_id = pwis.sale_order_id
     WHERE pwi.wave_id = p_wave_id
       AND o.deleted_at IS NULL
       AND o.status NOT IN ('Cancelada')
  ),
  abertas AS (
    SELECT os.stage_name, os.stage_order,
           GREATEST(0, os.quantity_total - COALESCE(os.quantity_processed, 0)) AS restante
      FROM public.order_stages os
      JOIN ops_da_onda d ON d.id = os.order_id
     WHERE os.status <> 'concluido'
  )
  SELECT
    (SELECT a.stage_name FROM abertas a ORDER BY a.stage_order, a.stage_name LIMIT 1),
    CASE
      WHEN (SELECT count(*) FROM ops_da_onda) = 0 THEN 'sem_op'
      WHEN (SELECT count(*) FROM abertas)     = 0 THEN 'concluida'
      ELSE 'em_producao'
    END,
    (SELECT count(*)::int FROM ops_da_onda),
    (SELECT count(*)::int FROM abertas),
    (SELECT COALESCE(sum(a.restante), 0)::int FROM abertas a);
$$;

COMMENT ON FUNCTION public.wave_derived_progress(uuid) IS
  'Progresso REAL da onda, derivado de order_stages: menor etapa ainda aberta '
  'entre as OPs. Sem etapa aberta = concluida; sem OP = sem_op. Substitui a '
  'leitura de production_wave_stages, que é máquina paralela e diverge em silêncio.';

GRANT EXECUTE ON FUNCTION public.wave_derived_progress(uuid) TO authenticated;

-- ── A view expõe o derivado AO LADO do gravado ──────────────────────────────
-- Aditivo de propósito: `current_stage` e `stages` continuam saindo como antes
-- (11 funções ainda escrevem neles), e o app passa a exibir o derivado. Assim dá
-- para comparar os dois em produção antes de aposentar a máquina paralela.
CREATE OR REPLACE VIEW public.v_wave_detail AS
SELECT w.id AS wave_id,
       w.code,
       w.week_start,
       w.week_end,
       w.status AS wave_status,
       w.current_stage,
       w.total_pairs,
       w.total_items,
       w.earliest_deadline,
       w.purchase_deadline,
       w.material_ready_date,
       w.corte_palmilha_start_date,
       w.corte_forracao_start_date,
       w.costura_start_date,
       w.mesa_start_date,
       w.silk_start_date,
       w.colagem_start_date,
       w.montagem_start_date,
       w.solagem_start_date,
       w.acabamento_start_date,
       d.sector         AS derived_sector,
       d.situacao       AS derived_situacao,
       d.ops            AS derived_ops,
       d.etapas_abertas AS derived_open_stages,
       d.pares_abertos  AS derived_open_pairs,
       ( SELECT jsonb_agg(jsonb_build_object(
                  'stage', s.stage, 'status', s.status, 'progress_pct', s.progress_pct,
                  'started_at', s.started_at, 'finished_at', s.finished_at)
                ORDER BY stage_order(s.stage))
           FROM production_wave_stages s
          WHERE s.wave_id = w.id) AS stages,
       ( SELECT jsonb_agg(jsonb_build_object(
                  'item_id', wi.id, 'reference_id', wi.reference_id,
                  'reference_name', ts.name, 'sole_product_id', wi.sole_product_id,
                  'sole_name', p_sole.name, 'color', wi.color,
                  'total_quantity', wi.total_quantity, 'grade', wi.grade)
                ORDER BY p_sole.name, ts.name, wi.color)
           FROM production_wave_items wi
           LEFT JOIN technical_sheets ts ON ts.id = wi.reference_id
           LEFT JOIN products p_sole     ON p_sole.id = wi.sole_product_id
          WHERE wi.wave_id = w.id) AS items
  FROM production_waves w
  LEFT JOIN LATERAL public.wave_derived_progress(w.id) d ON true;

-- ── A onda órfã (Q16=a) ─────────────────────────────────────────────────────
-- a3d78412 nasceu em 19/05 já com 0 itens e 6 etapas, e não perdeu PVs depois
-- (não foi o tg_remove_pv_from_waves_on_status_change). Foi criada e iniciada
-- vazia. Cancelada com motivo registrado.
UPDATE public.production_waves
   SET status = 'cancelled',
       notes  = COALESCE(notes || E'\n', '')
                || '[11/08/2026] Cancelada na migration 20261231120900: onda iniciada sem itens '
                || '(0 production_wave_items desde a criação em 19/05). Aparecia como "running · corte" '
                || 'no quadro sem nenhuma OP por trás.'
 WHERE status = 'running'
   AND NOT EXISTS (SELECT 1 FROM public.production_wave_items i WHERE i.wave_id = production_waves.id);

-- ── E a porta que deixou a órfã nascer ──────────────────────────────────────
-- start_wave aceitava iniciar onda sem item nenhum. Guarda mínima, sem tocar no
-- resto do corpo da função.
CREATE OR REPLACE FUNCTION public.tg_block_start_of_empty_wave()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'running' AND COALESCE(OLD.status, '') <> 'running' THEN
    IF NOT EXISTS (SELECT 1 FROM public.production_wave_items i WHERE i.wave_id = NEW.id) THEN
      RAISE EXCEPTION 'Onda % não pode iniciar sem itens', COALESCE(NEW.code, NEW.id::text);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_start_of_empty_wave ON public.production_waves;
CREATE TRIGGER trg_block_start_of_empty_wave
  BEFORE UPDATE ON public.production_waves
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_start_of_empty_wave();
