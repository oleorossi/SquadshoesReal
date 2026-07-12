-- =============================================================================
-- REMODELAGEM PRODUÇÃO (specs/remodelagem-producao.md) — PARTE 1/3: SCHEMA
--
-- Motor dinâmico diário único que substitui as Ondas (R2/R9). Este arquivo cria:
--   • sector_settings           — R1: config global por setor (fluxo, capacidade,
--                                  equipe informativa, regras de transição)
--   • production_queue          — R2.1: fila de OPs abertas (due_date da semana de
--                                  faturamento + pin manual híbrido R2.5)
--   • production_schedule       — resultado materializado do motor (OP×setor×dia)
--   • production_engine_runs    — auditoria de cada recálculo (R2.8)
--   • overload_acknowledgements — R4.3: estouros aceitos com autoria
--   • production_pointings.confirmed_warnings — R6.3: quem confirmou cada aviso
--   • resolve_op_due_date()     — due_date = sexta da semana de faturamento do PV
--
-- Escrita em production_schedule/production_queue(rows) só via funções SECURITY
-- DEFINER (mesmo padrão append-only do production_pointings). O pin manual é a
-- única escrita direta do cliente na fila.
-- =============================================================================

-- 0) Data de "hoje" no fuso da fábrica ----------------------------------------
-- A virada do dia (rolagem de saldo R2.3) precisa acontecer à meia-noite de
-- Brasília, não de UTC (21:00 local).
CREATE OR REPLACE FUNCTION public.br_today()
RETURNS date
LANGUAGE sql
STABLE
AS $$ SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date $$;

-- 1) sector_settings ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sector_settings (
  sector                  text PRIMARY KEY,
  flow_order              integer NOT NULL,
  enabled                 boolean NOT NULL DEFAULT true,
  parallel_group          text NULL,
  daily_capacity_pairs    integer NOT NULL DEFAULT 600 CHECK (daily_capacity_pairs > 0),
  team_size               integer NULL CHECK (team_size IS NULL OR team_size >= 0),
  team_notes              text NULL,
  check_prev_sector_limit boolean NOT NULL DEFAULT true,
  check_material_reserved boolean NOT NULL DEFAULT true,
  -- Coluna da ficha técnica que sobrepõe a capacidade global pra referência (R1.3).
  -- ⚠ Mapeamento historicamente TROCADO (ver src/lib/sectorCapacity.ts): Corte
  -- Palmilha lê sewing_* e Corte Forração lê cutting_*. Preservado de propósito.
  ficha_capacity_column   text NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid NULL DEFAULT auth.uid()
);

INSERT INTO public.sector_settings
  (sector, flow_order, parallel_group, daily_capacity_pairs, ficha_capacity_column)
VALUES
  ('Corte Palmilha', 10, 'preparacao', 600, 'sewing_capacity_per_day'),
  ('Corte Forração', 20, 'preparacao', 600, 'cutting_capacity_per_day'),
  ('Aviamento',      30, 'preparacao', 600, 'mesa_daily_capacity'),
  ('Costura',        40, 'preparacao', 600, 'costura_capacity_per_day'),
  ('Silk',           50, NULL,         600, 'silk_capacity_per_day'),
  ('Colagem',        60, NULL,         600, 'gluing_capacity_per_day'),
  ('Montagem',       70, NULL,         600, 'assembly_capacity_per_day'),
  ('Solagem',        80, NULL,         600, 'soling_capacity_per_day'),
  ('Acabamento',     90, NULL,         600, 'finishing_capacity_per_day'),
  ('Expedição',     100, NULL,         600, 'expedition_capacity_per_day')
ON CONFLICT (sector) DO NOTHING;

ALTER TABLE public.sector_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approved_select_sector_settings ON public.sector_settings;
CREATE POLICY approved_select_sector_settings
  ON public.sector_settings FOR SELECT USING (public.is_approved_user());
DROP POLICY IF EXISTS approved_update_sector_settings ON public.sector_settings;
CREATE POLICY approved_update_sector_settings
  ON public.sector_settings FOR UPDATE
  USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());
-- Lista de setores é FIXA (decisão do dono): sem policy de INSERT/DELETE.

-- 2) production_queue ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.production_queue (
  order_id        uuid PRIMARY KEY REFERENCES public.orders(id) ON DELETE CASCADE,
  due_date        date NULL,
  pinned_position integer NULL,
  pinned_by       uuid NULL,
  pinned_at       timestamptz NULL,
  status          text NOT NULL DEFAULT 'na_fila'
                  CHECK (status IN ('na_fila','em_producao')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_production_queue_due ON public.production_queue(due_date);

ALTER TABLE public.production_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approved_select_production_queue ON public.production_queue;
CREATE POLICY approved_select_production_queue
  ON public.production_queue FOR SELECT USING (public.is_approved_user());
-- Pin manual (R2.5) é a única escrita direta do cliente:
DROP POLICY IF EXISTS approved_pin_production_queue ON public.production_queue;
CREATE POLICY approved_pin_production_queue
  ON public.production_queue FOR UPDATE
  USING (public.is_approved_user()) WITH CHECK (public.is_approved_user());

-- 3) production_schedule ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.production_schedule (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recalc_run_id   uuid NOT NULL,
  order_id        uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  sector          text NOT NULL,
  date            date NOT NULL,
  planned_pairs   integer NOT NULL CHECK (planned_pairs > 0),
  carryover_pairs integer NOT NULL DEFAULT 0 CHECK (carryover_pairs >= 0),
  capacity_source text NOT NULL DEFAULT 'global'
                  CHECK (capacity_source IN ('global','ficha_override')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prod_sched_sector_date ON public.production_schedule(sector, date);
CREATE INDEX IF NOT EXISTS idx_prod_sched_order       ON public.production_schedule(order_id);
CREATE INDEX IF NOT EXISTS idx_prod_sched_date        ON public.production_schedule(date);

ALTER TABLE public.production_schedule ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approved_select_production_schedule ON public.production_schedule;
CREATE POLICY approved_select_production_schedule
  ON public.production_schedule FOR SELECT USING (public.is_approved_user());
-- Escrita só via recompute_production_schedule() (SECURITY DEFINER).

-- 4) production_engine_runs ---------------------------------------------------
CREATE TABLE IF NOT EXISTS public.production_engine_runs (
  run_id          uuid PRIMARY KEY,
  ran_at          timestamptz NOT NULL DEFAULT now(),
  ran_on          date NOT NULL DEFAULT public.br_today(),
  duration_ms     integer NULL,
  queue_size      integer NULL,
  scheduled_pairs integer NULL,
  horizon_end     date NULL,
  triggered_by    text NULL
);
ALTER TABLE public.production_engine_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approved_select_engine_runs ON public.production_engine_runs;
CREATE POLICY approved_select_engine_runs
  ON public.production_engine_runs FOR SELECT USING (public.is_approved_user());

-- 5) overload_acknowledgements (R4.3 "Aceitar atraso") ------------------------
CREATE TABLE IF NOT EXISTS public.overload_acknowledgements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key   text NOT NULL UNIQUE,   -- 'late:<order_id>' | 'backlog:<sector>'
  order_id    uuid NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  sector      text NULL,
  reason      text NULL,
  accepted_by uuid NULL DEFAULT auth.uid(),
  accepted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.overload_acknowledgements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS approved_select_overload_acks ON public.overload_acknowledgements;
CREATE POLICY approved_select_overload_acks
  ON public.overload_acknowledgements FOR SELECT USING (public.is_approved_user());
DROP POLICY IF EXISTS approved_insert_overload_acks ON public.overload_acknowledgements;
CREATE POLICY approved_insert_overload_acks
  ON public.overload_acknowledgements FOR INSERT WITH CHECK (public.is_approved_user());
DROP POLICY IF EXISTS approved_delete_overload_acks ON public.overload_acknowledgements;
CREATE POLICY approved_delete_overload_acks
  ON public.overload_acknowledgements FOR DELETE USING (public.is_approved_user());

-- 6) Autoria da confirmação de avisos no ledger (R6.3) ------------------------
ALTER TABLE public.production_pointings
  ADD COLUMN IF NOT EXISTS confirmed_warnings text[] NULL;

-- 7) resolve_op_due_date ------------------------------------------------------
-- due_date da OP = ÚLTIMO DIA ÚTIL (sexta) da semana de faturamento do PV.
-- Reusa resolve_billing_week_for_order (retorna a SEGUNDA da semana; já trata
-- delivery_month+delivery_week, billing_week literal e fallback por lead time).
-- Fallbacks: delivery_deadline do PV → planned_delivery da OP → NULL (fila
-- trata NULL como menor prioridade e o Estouro sinaliza "sem prazo").
CREATE OR REPLACE FUNCTION public.resolve_op_due_date(p_order_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_order record;
  v_monday date;
BEGIN
  SELECT sale_order_id, planned_delivery INTO v_order
    FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_order.sale_order_id IS NOT NULL THEN
    v_monday := public.resolve_billing_week_for_order(v_order.sale_order_id);
    IF v_monday IS NOT NULL THEN
      RETURN v_monday + 4;  -- sexta-feira da semana de faturamento
    END IF;
    RETURN (SELECT delivery_deadline FROM sale_orders WHERE id = v_order.sale_order_id);
  END IF;

  RETURN v_order.planned_delivery;
END;
$$;
